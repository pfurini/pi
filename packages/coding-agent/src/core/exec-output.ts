import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";

export const DEFAULT_EXEC_RETAINED_BYTES = 4 * 1024 * 1024;
export const HARD_EXEC_RETAINED_BYTES = 16 * 1024 * 1024;
export const EXEC_SPILL_LIMIT_BYTES = 64 * 1024 * 1024;
export const EXEC_SPILL_HIGH_WATER_MARK_BYTES = HARD_EXEC_RETAINED_BYTES;
export const EXEC_SPILL_WRITE_CHUNK_BYTES = 64 * 1024;

const MAX_TAIL_CHUNKS = 256;

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

	private tailChunks: Buffer[] = [];
	private tailBytes = 0;
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
			for (const chunk of this.tailChunks) this.writeToSpill(chunk);
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

	private async removePartialSpill(): Promise<void> {
		try {
			await this.writerSettled;
			if (this.spillPath) await rm(this.spillPath, { force: true });
		} catch (error) {
			this.recordInternalError(error);
		}
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

	private appendToTail(data: Buffer): void {
		if (data.length >= this.retainedLimitBytes) {
			this.tailChunks = [Buffer.from(data.subarray(data.length - this.retainedLimitBytes))];
			this.tailBytes = this.retainedLimitBytes;
			return;
		}

		this.tailChunks.push(data);
		this.tailBytes += data.length;
		while (this.tailBytes > this.retainedLimitBytes) {
			const first = this.tailChunks[0];
			const excess = this.tailBytes - this.retainedLimitBytes;
			if (first.length <= excess) {
				this.tailChunks.shift();
				this.tailBytes -= first.length;
			} else {
				this.tailChunks[0] = Buffer.from(first.subarray(excess));
				this.tailBytes -= excess;
			}
		}

		if (this.tailChunks.length > MAX_TAIL_CHUNKS) {
			this.tailChunks = [Buffer.concat(this.tailChunks, this.tailBytes)];
		}
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
		const tail = Buffer.concat(this.tailChunks, this.tailBytes);
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
