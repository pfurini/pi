/**
 * Shared command execution utilities for extensions and custom tools.
 */

import { spawn } from "node:child_process";
import { waitForChildProcess } from "../utils/child-process.ts";
import {
	DEFAULT_EXEC_RETAINED_BYTES,
	ExecOutputCollector,
	type ExecOutputSnapshot,
	type ExecOutputTruncation,
	formatExecTruncationNotice,
	HARD_EXEC_RETAINED_BYTES,
} from "./exec-output.ts";

export type { ExecOutputTruncation } from "./exec-output.ts";

/**
 * Options for executing shell commands.
 */
export interface ExecOptions {
	/** AbortSignal to cancel the command */
	signal?: AbortSignal;
	/** Timeout in milliseconds */
	timeout?: number;
	/** Working directory */
	cwd?: string;
	/** Rolling tail retained per stdout/stderr stream. Default 4 MiB; hard ceiling 16 MiB. */
	maxOutputBytes?: number;
	/**
	 * Append a `[pi.exec: ... truncated ...]` marker to a stream that was truncated, so callers that
	 * forward the text to a model do not silently present a tail as the whole output. Default `true`.
	 * Set to `false` when parsing the output programmatically and you handle the truncation fields
	 * yourself; the returned text is then raw bytes only.
	 */
	truncationNotice?: boolean;
}

/**
 * Result of executing a shell command.
 */
export interface ExecResult {
	/**
	 * Full output below the retained limit, otherwise a UTF-8-safe rolling tail followed by a
	 * truncation marker (suppress it with `truncationNotice: false`).
	 */
	stdout: string;
	/**
	 * Full output below the retained limit, otherwise a UTF-8-safe rolling tail followed by a
	 * truncation marker (suppress it with `truncationNotice: false`).
	 */
	stderr: string;
	code: number;
	/** Pi sent a termination signal (timeout, abort, or internal collector failure). */
	killed: boolean;
	stdoutTruncation?: ExecOutputTruncation;
	stderrTruncation?: ExecOutputTruncation;
	/** Unexpected collector/finalization failure. Normal truncation and spill limits are not errors. */
	internalError?: string;
}

/**
 * Execute a shell command and return stdout/stderr/code.
 * Supports timeout and abort signal.
 */
export async function execCommand(
	command: string,
	args: string[],
	cwd: string,
	options?: ExecOptions,
): Promise<ExecResult> {
	const requestedRetainedBytes = options?.maxOutputBytes;
	const retainedLimitBytes =
		requestedRetainedBytes !== undefined && Number.isSafeInteger(requestedRetainedBytes) && requestedRetainedBytes > 0
			? Math.min(requestedRetainedBytes, HARD_EXEC_RETAINED_BYTES)
			: DEFAULT_EXEC_RETAINED_BYTES;
	const stdoutCollector = new ExecOutputCollector({
		retainedLimitBytes,
		tempFilePrefix: "pi-exec-stdout",
	});
	const stderrCollector = new ExecOutputCollector({
		retainedLimitBytes,
		tempFilePrefix: "pi-exec-stderr",
	});

	const proc = spawn(command, args, {
		cwd,
		shell: false,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const forceWaitController = new AbortController();
	let killed = false;
	let acceptingOutput = true;
	let internalError: string | undefined;
	let timeoutId: NodeJS.Timeout | undefined;
	let escalationId: NodeJS.Timeout | undefined;

	const recordInternalError = (error: unknown): void => {
		internalError ??= error instanceof Error ? error.message : String(error);
	};
	const terminate = (): void => {
		if (killed) return;
		killed = true;
		try {
			proc.kill("SIGTERM");
		} catch (error) {
			recordInternalError(error);
		}
		escalationId = setTimeout(() => {
			try {
				if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
			} catch (error) {
				recordInternalError(error);
			} finally {
				forceWaitController.abort();
			}
		}, 5000);
	};
	const handleCollectorFailure = (error: unknown): void => {
		recordInternalError(error);
		acceptingOutput = false;
		terminate();
	};
	const onStdout = (data: Buffer): void => {
		if (!acceptingOutput) return;
		try {
			stdoutCollector.append(data);
		} catch (error) {
			handleCollectorFailure(error);
		}
	};
	const onStderr = (data: Buffer): void => {
		if (!acceptingOutput) return;
		try {
			stderrCollector.append(data);
		} catch (error) {
			handleCollectorFailure(error);
		}
	};

	proc.stdout?.on("data", onStdout);
	proc.stderr?.on("data", onStderr);
	const waitPromise = waitForChildProcess(proc, { forceSignal: forceWaitController.signal });
	const callerSignal = options?.signal;
	if (callerSignal?.aborted) {
		terminate();
	} else {
		callerSignal?.addEventListener("abort", terminate, { once: true });
	}
	if (options?.timeout && options.timeout > 0) timeoutId = setTimeout(terminate, options.timeout);

	let code: number;
	try {
		try {
			code = (await waitPromise) ?? 0;
		} catch {
			code = 1;
		}
	} finally {
		acceptingOutput = false;
		proc.stdout?.removeListener("data", onStdout);
		proc.stderr?.removeListener("data", onStderr);
		callerSignal?.removeEventListener("abort", terminate);
		if (timeoutId) clearTimeout(timeoutId);
		if (escalationId) clearTimeout(escalationId);
	}

	const [stdoutSnapshot, stderrSnapshot] = await Promise.all([stdoutCollector.finish(), stderrCollector.finish()]);
	if (stdoutSnapshot.internalError) recordInternalError(stdoutSnapshot.internalError);
	if (stderrSnapshot.internalError) recordInternalError(stderrSnapshot.internalError);
	if (internalError) code = 1;

	const withNotice = (snapshot: ExecOutputSnapshot, stream: "stdout" | "stderr"): string => {
		if (!snapshot.truncation || options?.truncationNotice === false) return snapshot.text;
		const notice = formatExecTruncationNotice(stream, snapshot.truncation);
		return snapshot.text ? `${snapshot.text}\n\n${notice}` : notice;
	};

	return {
		stdout: withNotice(stdoutSnapshot, "stdout"),
		stderr: withNotice(stderrSnapshot, "stderr"),
		code,
		killed,
		...(stdoutSnapshot.truncation ? { stdoutTruncation: stdoutSnapshot.truncation } : {}),
		...(stderrSnapshot.truncation ? { stderrTruncation: stderrSnapshot.truncation } : {}),
		...(internalError ? { internalError } : {}),
	};
}
