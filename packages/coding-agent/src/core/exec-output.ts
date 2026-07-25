import { randomBytes } from "node:crypto";
import { createWriteStream, unlinkSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";
import { formatSize } from "./tools/truncate.ts";

export const DEFAULT_EXEC_RETAINED_BYTES = 4 * 1024 * 1024;
export const HARD_EXEC_RETAINED_BYTES = 16 * 1024 * 1024;
export const EXEC_SPILL_LIMIT_BYTES = 64 * 1024 * 1024;
export const EXEC_SPILL_WRITE_CHUNK_BYTES = 64 * 1024;
/**
 * Bounds the writable's internal buffer, so it also bounds how much spill data a slow disk can
 * make us hold in memory. Must stay comfortably above EXEC_SPILL_WRITE_CHUNK_BYTES: a high-water
 * mark equal to the write chunk size makes `write()` report backpressure on the very first chunk
 * of a multi-chunk data event, which stops the spill (see writeToSpill) and leaves nearly every
 * spill file incomplete.
 */
export const EXEC_SPILL_HIGH_WATER_MARK_BYTES = 1024 * 1024;

/**
 * Chunk count at which the pre-overflow tail stops holding incoming buffers by reference and moves
 * to the ring. Each retained chunk costs a JS object regardless of its size, so a child writing a
 * few bytes at a time would otherwise accumulate object overhead several times its own output.
 */
const MAX_TAIL_CHUNKS = 1024;

export interface ExecOutputTruncation {
	truncated: true;
	/** Total raw bytes observed on this stream. */
	totalBytes: number;
	/** Raw tail bytes represented by the returned stdout/stderr text. */
	retainedBytes: number;
	/** Effective retained-tail limit after defaulting/clamping. */
	retainedLimitBytes: number;
	/** Fixed maximum bytes that may be persisted for this stream. */
	spillLimitBytes: number;
	/** Contiguous raw prefix persisted before a limit, backpressure gap, or error. */
	spill?: {
		path: string;
		bytes: number;
		complete: boolean;
	};
	/** Bytes not represented in the spill file (the returned tail may overlap these bytes). */
	discardedBytes: number;
	/** File creation/write failure; partial files are deleted and spill is omitted. */
	spillError?: string;
}

/**
 * Self-describing marker appended to a truncated stream, so a consumer that simply forwards the
 * text (an extension's tool result, a slash command, a hook) still tells the model that it is
 * looking at a tail, how much it is missing, and where the rest is. Appended at the end because
 * the tool-result layer truncates from the tail (see tools/truncate.ts), which keeps it.
 */
export function formatExecTruncationNotice(stream: "stdout" | "stderr", truncation: ExecOutputTruncation): string {
	const shown = `showing the last ${formatSize(truncation.retainedBytes)} of ${formatSize(truncation.totalBytes)}`;
	const spill = truncation.spill;
	let rest: string;
	if (spill?.complete) {
		rest = `Complete output saved to ${spill.path} (removed when pi exits)`;
	} else if (spill) {
		rest = `First ${formatSize(spill.bytes)} saved to ${spill.path} (removed when pi exits)`;
	} else if (truncation.spillError) {
		rest = `The rest could not be saved: ${truncation.spillError}`;
	} else {
		rest = "The rest was discarded";
	}
	return `[pi.exec: ${stream} truncated, ${shown}. ${rest}]`;
}

export interface ExecOutputSnapshot {
	text: string;
	truncation?: ExecOutputTruncation;
	internalError?: string;
}

export interface SpillWriterOptions {
	flags: "wx";
	mode: number;
	highWaterMark: number;
}

export type SpillWriterFactory = (path: string, options: SpillWriterOptions) => Writable;

export interface ExecOutputCollectorOptions {
	retainedLimitBytes: number;
	tempFilePrefix: string;
	spillLimitBytes?: number;
	tempDirectory?: string;
	spillWriterFactory?: SpillWriterFactory;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Spill files outlive `execCommand()` on purpose (the caller may still want to read them), so we
 * track the exact paths we created and unlink them when the process exits. Only paths this process
 * created are ever removed, never a tmpdir glob, so a concurrent pi process keeps its live files.
 * An abnormal termination (SIGKILL, power loss) still leaves them behind.
 */
const activeSpillPaths = new Set<string>();
let spillExitCleanupRegistered = false;

function registerSpillPath(path: string): void {
	activeSpillPaths.add(path);
	if (spillExitCleanupRegistered) return;
	spillExitCleanupRegistered = true;
	process.on("exit", () => {
		for (const spillPath of activeSpillPaths) {
			try {
				unlinkSync(spillPath);
			} catch {
				// Best effort: the file may already be gone, or the caller may have moved it.
			}
		}
		activeSpillPaths.clear();
	});
}

function normalizeRetainedLimit(value: number): number {
	if (!Number.isSafeInteger(value) || value <= 0) return DEFAULT_EXEC_RETAINED_BYTES;
	return Math.min(value, HARD_EXEC_RETAINED_BYTES);
}

function normalizeSpillLimit(value: number | undefined): number {
	if (value === undefined || !Number.isSafeInteger(value) || value <= 0) return EXEC_SPILL_LIMIT_BYTES;
	return Math.min(value, EXEC_SPILL_LIMIT_BYTES);
}

export class ExecOutputCollector {
	private readonly retainedLimitBytes: number;
	private readonly tempFilePrefix: string;
	private readonly spillLimitBytes: number;
	private readonly tempDirectory: string;
	private readonly spillWriterFactory: SpillWriterFactory;

	/** Pre-overflow tail: plain chunk references, bounded by retainedLimitBytes of data. */
	private tailChunks: Buffer[] = [];
	private tailBytes = 0;
	/** Post-overflow tail: fixed-size circular buffer, allocated once truncation starts. */
	private ring: Buffer | undefined;
	private ringStart = 0;
	private ringLength = 0;
	private totalBytes = 0;
	private truncated = false;
	private accepting = true;

	private spillPath: string | undefined;
	private spillWriter: Writable | undefined;
	private spillBytes = 0;
	private spillBackpressured = false;
	private spillStopped = false;
	private spillError: string | undefined;
	private spillCleanup: Promise<void> | undefined;
	private writerSettled: Promise<void> | undefined;
	private resolveWriterSettled: (() => void) | undefined;

	private internalError: string | undefined;
	private finishPromise: Promise<ExecOutputSnapshot> | undefined;

	constructor(options: ExecOutputCollectorOptions) {
		this.retainedLimitBytes = normalizeRetainedLimit(options.retainedLimitBytes);
		this.tempFilePrefix = options.tempFilePrefix;
		this.spillLimitBytes = normalizeSpillLimit(options.spillLimitBytes);
		this.tempDirectory = options.tempDirectory ?? tmpdir();
		this.spillWriterFactory =
			options.spillWriterFactory ?? ((path, writerOptions) => createWriteStream(path, writerOptions));
	}

	append(data: Buffer): void {
		if (!this.accepting) throw new Error("Cannot append to a finished output collector");
		if (data.length === 0) return;

		const firstOverflow = !this.truncated && this.totalBytes + data.length > this.retainedLimitBytes;
		this.totalBytes += data.length;

		if (firstOverflow) {
			this.truncated = true;
			this.startSpill();
			// Everything seen so far still fits the retained limit, so the tail is the whole output
			// and is exactly the prefix the spill needs, whichever representation is holding it.
			// The copy matters: writer.write() keeps its argument queued, and readTail() can hand
			// back a view of the ring that later appends will overwrite.
			this.writeToSpill(Buffer.from(this.readTail()));
		}
		if (this.truncated) this.writeToSpill(data);

		this.appendToTail(data);
	}

	finish(): Promise<ExecOutputSnapshot> {
		if (!this.finishPromise) {
			this.accepting = false;
			this.finishPromise = this.finishOnce().catch((error: unknown) => {
				this.recordInternalError(error);
				try {
					return this.createSnapshot();
				} catch (snapshotError) {
					this.recordInternalError(snapshotError);
					return { text: "", internalError: this.internalError };
				}
			});
		}
		return this.finishPromise;
	}

	private startSpill(): void {
		if (this.spillWriter || this.spillPath || this.spillStopped) return;

		const id = randomBytes(8).toString("hex");
		const path = join(this.tempDirectory, `${this.tempFilePrefix}-${id}.log`);
		this.spillPath = path;

		try {
			const writer = this.spillWriterFactory(path, {
				flags: "wx",
				mode: 0o600,
				highWaterMark: EXEC_SPILL_HIGH_WATER_MARK_BYTES,
			});
			this.spillWriter = writer;
			registerSpillPath(path);
			this.writerSettled = new Promise<void>((resolve) => {
				this.resolveWriterSettled = resolve;
			});
			writer.on("error", this.onSpillError);
			writer.on("drain", this.onSpillDrain);
			writer.once("finish", this.onWriterSettled);
			writer.once("close", this.onWriterSettled);
		} catch (error) {
			this.handleSpillError(error);
		}
	}

	private readonly onSpillDrain = (): void => {
		if (!this.spillStopped && !this.spillError) this.spillBackpressured = false;
	};

	private readonly onWriterSettled = (): void => {
		this.resolveWriterSettled?.();
		this.resolveWriterSettled = undefined;
	};

	private readonly onSpillError = (error: Error): void => {
		this.handleSpillError(error);
	};

	private handleSpillError(error: unknown): void {
		if (this.spillError) return;
		this.spillError = errorMessage(error);
		this.spillStopped = true;
		this.spillBackpressured = false;

		const writer = this.spillWriter;
		if (writer && !writer.destroyed) writer.destroy();
		this.spillCleanup = this.removePartialSpill();
	}

	/**
	 * Failures here concern only the partial spill file, never the captured output, so they are
	 * appended to `spillError` instead of becoming `internalError` (which exec.ts turns into a
	 * non-zero exit code for a command that may well have succeeded).
	 */
	private async removePartialSpill(): Promise<void> {
		try {
			await this.writerSettled;
		} catch (error) {
			this.noteSpillCleanupFailure(error);
		}
		const path = this.spillPath;
		if (!path) return;
		try {
			await rm(path, { force: true });
			activeSpillPaths.delete(path);
		} catch (error) {
			this.noteSpillCleanupFailure(error);
		}
	}

	private noteSpillCleanupFailure(error: unknown): void {
		const message = `failed to remove partial spill file: ${errorMessage(error)}`;
		this.spillError = this.spillError ? `${this.spillError} (${message})` : message;
	}

	private writeToSpill(data: Buffer): void {
		if (data.length === 0 || this.spillStopped || this.spillError) return;
		if (this.spillBackpressured) {
			this.spillStopped = true;
			return;
		}

		const writer = this.spillWriter;
		if (!writer) return;

		let offset = 0;
		while (offset < data.length) {
			const remainingCapacity = this.spillLimitBytes - this.spillBytes;
			if (remainingCapacity <= 0) {
				this.spillStopped = true;
				return;
			}

			const length = Math.min(EXEC_SPILL_WRITE_CHUNK_BYTES, remainingCapacity, data.length - offset);
			const chunk = data.subarray(offset, offset + length);
			let accepted: boolean;
			try {
				accepted = writer.write(chunk);
			} catch (error) {
				this.handleSpillError(error);
				return;
			}
			this.spillBytes += length;
			offset += length;

			if (!accepted) {
				this.spillBackpressured = true;
				if (offset < data.length) this.spillStopped = true;
				return;
			}
		}
	}

	/**
	 * Before the retained limit is first exceeded, the tail is exactly the whole output, so chunks
	 * are just held by reference. Once the output overflows the limit or arrives in too many pieces,
	 * the tail moves to a fixed-size ring: every byte is copied once and nothing is ever recopied,
	 * which keeps a stream of many small chunks linear instead of quadratic in the retained limit.
	 */
	private appendToTail(data: Buffer): void {
		if (!this.truncated && !this.ring) {
			this.tailChunks.push(data);
			this.tailBytes += data.length;
			if (this.tailChunks.length > MAX_TAIL_CHUNKS) this.allocateRing();
			return;
		}
		if (!this.ring) this.allocateRing();
		this.writeToRing(data);
	}

	private allocateRing(): void {
		this.ring = Buffer.allocUnsafe(this.retainedLimitBytes);
		this.ringStart = 0;
		this.ringLength = 0;
		for (const chunk of this.tailChunks) this.writeToRing(chunk);
		this.tailChunks = [];
		this.tailBytes = 0;
	}

	private writeToRing(data: Buffer): void {
		const ring = this.ring;
		if (!ring) return;

		const capacity = ring.length;
		const source = data.length > capacity ? data.subarray(data.length - capacity) : data;
		if (source.length === 0) return;

		const writeStart = (this.ringStart + this.ringLength) % capacity;
		const firstSpan = Math.min(source.length, capacity - writeStart);
		source.copy(ring, writeStart, 0, firstSpan);
		if (firstSpan < source.length) source.copy(ring, 0, firstSpan);

		const filled = this.ringLength + source.length;
		if (filled > capacity) {
			this.ringStart = (this.ringStart + (filled - capacity)) % capacity;
			this.ringLength = capacity;
		} else {
			this.ringLength = filled;
		}
	}

	private readTail(): Buffer {
		const ring = this.ring;
		if (!ring) return Buffer.concat(this.tailChunks, this.tailBytes);

		const capacity = ring.length;
		const end = this.ringStart + this.ringLength;
		if (end <= capacity) return ring.subarray(this.ringStart, end);
		return Buffer.concat([ring.subarray(this.ringStart), ring.subarray(0, end - capacity)], this.ringLength);
	}

	private async finishOnce(): Promise<ExecOutputSnapshot> {
		const writer = this.spillWriter;
		if (writer && !this.spillError) {
			try {
				if (!writer.writableFinished && !writer.destroyed) writer.end();
				await this.writerSettled;
			} catch (error) {
				this.recordInternalError(error);
				this.handleSpillError(error);
			}
		}
		if (this.spillCleanup) await this.spillCleanup;
		return this.createSnapshot();
	}

	private createSnapshot(): ExecOutputSnapshot {
		const tail = this.readTail();
		let start = 0;
		if (this.truncated) {
			for (const byte of tail) {
				if ((byte & 0xc0) !== 0x80) break;
				start++;
			}
		}
		const representedTail = tail.subarray(start);
		const snapshot: ExecOutputSnapshot = { text: representedTail.toString("utf-8") };

		if (this.truncated) {
			const spill =
				this.spillPath && !this.spillError
					? {
							path: this.spillPath,
							bytes: this.spillBytes,
							complete: this.spillBytes === this.totalBytes,
						}
					: undefined;
			snapshot.truncation = {
				truncated: true,
				totalBytes: this.totalBytes,
				retainedBytes: representedTail.length,
				retainedLimitBytes: this.retainedLimitBytes,
				spillLimitBytes: this.spillLimitBytes,
				spill,
				discardedBytes: this.totalBytes - (spill?.bytes ?? 0),
				spillError: this.spillError,
			};
		}
		if (this.internalError) snapshot.internalError = this.internalError;
		return snapshot;
	}

	private recordInternalError(error: unknown): void {
		if (!this.internalError) this.internalError = errorMessage(error);
	}
}
