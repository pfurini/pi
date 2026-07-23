import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ExecOptions, type ExecResult, execCommand } from "../src/core/exec.ts";
import {
	DEFAULT_EXEC_RETAINED_BYTES,
	EXEC_SPILL_LIMIT_BYTES,
	HARD_EXEC_RETAINED_BYTES,
} from "../src/core/exec-output.ts";

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	let timeout: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_resolve, reject) => {
				timeout = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

function writerScript(fileDescriptor: 1 | 2, totalBytes: number, byte: number, exitCode = 0): string {
	return `const { writeSync } = require("node:fs"); const chunk = Buffer.alloc(64 * 1024, ${byte}); let remaining = ${totalBytes}; while (remaining > 0) { const length = Math.min(chunk.length, remaining); writeSync(${fileDescriptor}, chunk, 0, length); remaining -= length; } process.exitCode = ${exitCode};`;
}

describe("execCommand", () => {
	let testDirectory: string;
	const spillPaths = new Set<string>();

	beforeEach(() => {
		testDirectory = mkdtempSync(join(tmpdir(), "pi-exec-test-"));
	});

	afterEach(() => {
		for (const path of spillPaths) rmSync(path, { force: true });
		spillPaths.clear();
		rmSync(testDirectory, { recursive: true, force: true });
	});

	function trackSpills(result: ExecResult): void {
		if (result.stdoutTruncation?.spill?.path) spillPaths.add(result.stdoutTruncation.spill.path);
		if (result.stderrTruncation?.spill?.path) spillPaths.add(result.stderrTruncation.spill.path);
	}

	async function execNode(script: string, options?: ExecOptions): Promise<ExecResult> {
		const result = await execCommand(process.execPath, ["-e", script], testDirectory, options);
		trackSpills(result);
		return result;
	}

	it("returns exact small stdout and stderr without metadata", async () => {
		const result = await execNode('process.stdout.write("out"); process.stderr.write("err"); process.exitCode = 3;');

		expect(result).toEqual({ stdout: "out", stderr: "err", code: 3, killed: false });
	});

	it("returns an exact stdout tail and complete spill without changing the exit code", async () => {
		const totalBytes = 1024 * 1024;
		const result = await execNode(writerScript(1, totalBytes, 0x78, 23), { maxOutputBytes: 4096 });

		expect(result.code).toBe(23);
		expect(result.killed).toBe(false);
		expect(Buffer.byteLength(result.stdout)).toBe(4096);
		expect(result.stdout).toBe("x".repeat(4096));
		expect(result.stderr).toBe("");
		expect(result.stdoutTruncation).toMatchObject({
			totalBytes,
			retainedBytes: 4096,
			retainedLimitBytes: 4096,
			discardedBytes: 0,
			spill: { bytes: totalBytes, complete: true },
		});
	});

	it("applies the same bounded behavior independently to stderr", async () => {
		const totalBytes = 256 * 1024;
		const result = await execNode(writerScript(2, totalBytes, 0x65, 17), { maxOutputBytes: 2048 });

		expect(result.code).toBe(17);
		expect(result.killed).toBe(false);
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe("e".repeat(2048));
		expect(result.stderrTruncation).toMatchObject({
			totalBytes,
			retainedBytes: 2048,
			retainedLimitBytes: 2048,
			spill: { bytes: totalBytes, complete: true },
		});
	});

	it("bounds simultaneous stdout and stderr floods independently", async () => {
		const totalBytes = 256 * 1024;
		const script = `const { writeSync } = require("node:fs"); const out = Buffer.alloc(64 * 1024, 0x6f); const err = Buffer.alloc(64 * 1024, 0x65); for (let i = 0; i < 4; i++) { writeSync(1, out); writeSync(2, err); } process.exitCode = 9;`;
		const result = await execNode(script, { maxOutputBytes: 1024 });

		expect(result.code).toBe(9);
		expect(result.stdout).toBe("o".repeat(1024));
		expect(result.stderr).toBe("e".repeat(1024));
		expect(result.stdoutTruncation).toMatchObject({ totalBytes, retainedBytes: 1024 });
		expect(result.stderrTruncation).toMatchObject({ totalBytes, retainedBytes: 1024 });
		expect(result.stdoutTruncation?.spill?.path).not.toBe(result.stderrTruncation?.spill?.path);
	});

	it("defaults invalid retained limits and clamps values above the hard ceiling", async () => {
		for (const maxOutputBytes of [0.5, Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
			const totalBytes = DEFAULT_EXEC_RETAINED_BYTES + 1;
			const result = await execNode(writerScript(1, totalBytes, 0x64), { maxOutputBytes });
			expect(result.stdoutTruncation).toMatchObject({
				totalBytes,
				retainedLimitBytes: DEFAULT_EXEC_RETAINED_BYTES,
				retainedBytes: DEFAULT_EXEC_RETAINED_BYTES,
			});
		}

		const totalBytes = HARD_EXEC_RETAINED_BYTES + 1;
		const clamped = await execNode(writerScript(1, totalBytes, 0x63), { maxOutputBytes: Number.MAX_SAFE_INTEGER });
		expect(clamped.stdoutTruncation).toMatchObject({
			totalBytes,
			retainedLimitBytes: HARD_EXEC_RETAINED_BYTES,
			retainedBytes: HARD_EXEC_RETAINED_BYTES,
			spillLimitBytes: EXEC_SPILL_LIMIT_BYTES,
		});
	});

	it("resolves ENOENT as code 1 and rejects synchronous spawn validation errors", async () => {
		const missing = await execCommand(`pi-missing-command-${Date.now()}`, [], testDirectory);
		expect(missing).toEqual({ stdout: "", stderr: "", code: 1, killed: false });

		await expect(execCommand("", [], testDirectory)).rejects.toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
	});

	it("terminates on timeout and AbortSignal with killed true", async () => {
		const timedOut = await withTimeout(execNode("setInterval(() => {}, 1000)", { timeout: 100 }), 3000);
		expect(timedOut.killed).toBe(true);

		const controller = new AbortController();
		const abortedPromise = execNode("setInterval(() => {}, 1000)", { signal: controller.signal });
		setTimeout(() => controller.abort(), 100);
		const aborted = await withTimeout(abortedPromise, 3000);
		expect(aborted.killed).toBe(true);
	});

	it.skipIf(process.platform === "win32")("escalates a SIGTERM-ignoring child to SIGKILL and settles", async () => {
		const startedAt = Date.now();
		const result = await withTimeout(
			execNode('process.on("SIGTERM", () => {}); process.stdout.write("ready\\n"); setInterval(() => {}, 1000);', {
				timeout: 250,
			}),
			8000,
		);

		expect(result.killed).toBe(true);
		expect(result.stdout).toContain("ready");
		expect(Date.now() - startedAt).toBeGreaterThanOrEqual(4500);
	});

	it.skipIf(process.platform === "win32")(
		"captures finite inherited descendant output after the shell exits",
		async () => {
			const command = 'printf "HEAD\\n"; ( for i in 1 2 3 4 5 6; do sleep 0.05; printf "TICK$i\\n"; done ) &';
			const result = await withTimeout(
				execCommand("/bin/sh", ["-c", command], testDirectory, { maxOutputBytes: 16 }),
				3000,
			);
			trackSpills(result);

			expect(result.code).toBe(0);
			expect(result.killed).toBe(false);
			expect(result.stdout).toContain("TICK6");
			expect(result.stdoutTruncation).toMatchObject({
				totalBytes: 41,
				retainedBytes: 16,
				retainedLimitBytes: 16,
			});
		},
	);
});
