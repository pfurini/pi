import { randomBytes } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_TEMP_FILE_BYTES, registerTempFile } from "../temp-file-registry.ts";
import {
	capLineLengths,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINE_CHARS,
	DEFAULT_MAX_LINES,
	type TruncationResult,
	truncateTail,
} from "./truncate.ts";

export interface OutputAccumulatorOptions {
	maxLines?: number;
	maxBytes?: number;
	tempFilePrefix?: string;
	/** Max bytes persisted to the full-output temp file. 0 means unlimited. */
	maxTempFileBytes?: number;
	/** Max chars per line in snapshot content; 0 disables. Default: 1000. */
	maxLineChars?: number;
}

export interface OutputSnapshot {
	content: string;
	truncation: TruncationResult;
	fullOutputPath?: string;
	/** Bytes persisted to `fullOutputPath`. */
	fullOutputBytes?: number;
	/** True when the temp file holds only a prefix because the cap was reached. */
	fullOutputCapped?: boolean;
	/** Lines in `content` capped at `maxLineChars`. */
	cappedLineCount: number;
	/** Effective per-line char cap (0 = disabled). */
	maxLineChars: number;
}

function defaultTempFilePath(prefix: string): string {
	const id = randomBytes(8).toString("hex");
	return join(tmpdir(), `${prefix}-${id}.log`);
}

function byteLength(text: string): number {
	return Buffer.byteLength(text, "utf-8");
}

/**
 * Incrementally tracks streaming output with bounded memory.
 *
 * Appends decode chunks with a streaming UTF-8 decoder, keeps only a decoded
 * tail for display snapshots, and opens a temp file when the full output needs
 * to be preserved.
 */
export class OutputAccumulator {
	private readonly maxLines: number;
	private readonly maxBytes: number;
	private readonly maxLineChars: number;
	private readonly maxRollingBytes: number;
	private readonly tempFilePrefix: string;
	private readonly maxTempFileBytes: number;
	private readonly decoder = new TextDecoder();

	private rawChunks: Buffer[] = [];
	private tailText = "";
	private tailBytes = 0;
	private tailStartsAtLineBoundary = true;
	private totalRawBytes = 0;
	private totalDecodedBytes = 0;
	private completedLines = 0;
	private totalLines = 0;
	private currentLineBytes = 0;
	private hasOpenLine = false;
	private finished = false;

	private tempFilePath: string | undefined;
	private tempFileStream: WriteStream | undefined;
	private tempFileBytes = 0;
	private tempFileCapped = false;

	constructor(options: OutputAccumulatorOptions = {}) {
		this.maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
		this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
		this.maxLineChars = options.maxLineChars ?? DEFAULT_MAX_LINE_CHARS;
		this.maxRollingBytes = Math.max(this.maxBytes * 2, 1);
		this.tempFilePrefix = options.tempFilePrefix ?? "pi-output";
		this.maxTempFileBytes = options.maxTempFileBytes ?? DEFAULT_MAX_TEMP_FILE_BYTES;
	}

	append(data: Buffer): void {
		if (this.finished) {
			throw new Error("Cannot append to a finished output accumulator");
		}

		this.totalRawBytes += data.length;
		this.appendDecodedText(this.decoder.decode(data, { stream: true }));

		if (this.tempFileStream || this.shouldUseTempFile()) {
			this.ensureTempFile();
			this.writeToTempFile(data);
		} else if (data.length > 0) {
			this.rawChunks.push(data);
		}
	}

	finish(): void {
		if (this.finished) {
			return;
		}
		this.finished = true;
		this.appendDecodedText(this.decoder.decode());
		if (this.shouldUseTempFile()) {
			this.ensureTempFile();
		}
	}

	snapshot(options: { persistIfTruncated?: boolean } = {}): OutputSnapshot {
		// Cap line lengths before the tail budget so freed budget holds more real
		// lines; the temp file keeps receiving raw bytes, so recovery stays lossless.
		const capped = capLineLengths(this.getSnapshotText(), this.maxLineChars);
		const tailTruncation = truncateTail(capped.content, {
			maxLines: this.maxLines,
			maxBytes: this.maxBytes,
		});
		const truncated = this.totalLines > this.maxLines || this.totalDecodedBytes > this.maxBytes;
		const truncatedBy = truncated
			? (tailTruncation.truncatedBy ?? (this.totalDecodedBytes > this.maxBytes ? "bytes" : "lines"))
			: null;
		const truncation: TruncationResult = {
			...tailTruncation,
			truncated,
			truncatedBy,
			totalLines: this.totalLines,
			totalBytes: this.totalDecodedBytes,
			maxLines: this.maxLines,
			maxBytes: this.maxBytes,
		};

		// Only capped lines that survive tail truncation count: the kept window is
		// the last `outputLines` lines of the capped text, so the flags align 1:1.
		// The explicit 0 check matters: `slice(-0)` would return every flag instead of none.
		const cappedLineCount =
			tailTruncation.outputLines > 0
				? capped.cappedLines.slice(-tailTruncation.outputLines).filter((wasCapped) => wasCapped).length
				: 0;

		if (options.persistIfTruncated && (truncation.truncated || cappedLineCount > 0)) {
			this.ensureTempFile();
		}

		return {
			content: truncation.content,
			truncation,
			fullOutputPath: this.tempFilePath,
			fullOutputBytes: this.tempFilePath ? this.tempFileBytes : undefined,
			fullOutputCapped: this.tempFilePath ? this.tempFileCapped : undefined,
			cappedLineCount,
			maxLineChars: this.maxLineChars,
		};
	}

	async closeTempFile(): Promise<void> {
		if (!this.tempFileStream) {
			return;
		}

		const stream = this.tempFileStream;
		this.tempFileStream = undefined;

		await new Promise<void>((resolve, reject) => {
			const onError = (error: Error) => {
				stream.off("finish", onFinish);
				reject(error);
			};
			const onFinish = () => {
				stream.off("error", onError);
				resolve();
			};
			stream.once("error", onError);
			stream.once("finish", onFinish);
			stream.end();
		});
	}

	getLastLineBytes(): number {
		return this.currentLineBytes;
	}

	private appendDecodedText(text: string): void {
		if (text.length === 0) {
			return;
		}

		const bytes = byteLength(text);
		this.totalDecodedBytes += bytes;
		this.tailText += text;
		this.tailBytes += bytes;
		if (this.tailBytes > this.maxRollingBytes * 2) {
			this.trimTail();
		}

		let newlines = 0;
		let lastNewline = -1;
		for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
			newlines++;
			lastNewline = i;
		}
		if (newlines === 0) {
			this.currentLineBytes += bytes;
			this.hasOpenLine = true;
		} else {
			this.completedLines += newlines;
			const tail = text.slice(lastNewline + 1);
			this.currentLineBytes = byteLength(tail);
			this.hasOpenLine = tail.length > 0;
		}
		this.totalLines = this.completedLines + (this.hasOpenLine ? 1 : 0);
	}

	private trimTail(): void {
		const buffer = Buffer.from(this.tailText, "utf-8");
		if (buffer.length <= this.maxRollingBytes) {
			this.tailBytes = buffer.length;
			return;
		}

		let start = buffer.length - this.maxRollingBytes;
		while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) {
			start++;
		}

		this.tailStartsAtLineBoundary = start === 0 ? this.tailStartsAtLineBoundary : buffer[start - 1] === 0x0a;
		this.tailText = buffer.subarray(start).toString("utf-8");
		this.tailBytes = byteLength(this.tailText);
	}

	private getSnapshotText(): string {
		if (this.tailStartsAtLineBoundary) {
			return this.tailText;
		}

		const firstNewline = this.tailText.indexOf("\n");
		return firstNewline === -1 ? this.tailText : this.tailText.slice(firstNewline + 1);
	}

	/** Persist up to the cap, then stop; the snapshot reports the file as a prefix. */
	private writeToTempFile(data: Buffer): void {
		const stream = this.tempFileStream;
		if (!stream || this.tempFileCapped || data.length === 0) return;

		if (this.maxTempFileBytes <= 0) {
			stream.write(data);
			this.tempFileBytes += data.length;
			return;
		}

		const remaining = this.maxTempFileBytes - this.tempFileBytes;
		if (remaining <= 0) {
			this.tempFileCapped = true;
			return;
		}
		const chunk = data.length <= remaining ? data : data.subarray(0, remaining);
		stream.write(chunk);
		this.tempFileBytes += chunk.length;
		if (chunk.length < data.length) this.tempFileCapped = true;
	}

	private shouldUseTempFile(): boolean {
		return (
			this.totalRawBytes > this.maxBytes || this.totalDecodedBytes > this.maxBytes || this.totalLines > this.maxLines
		);
	}

	private ensureTempFile(): void {
		if (this.tempFilePath) {
			return;
		}
		this.tempFilePath = defaultTempFilePath(this.tempFilePrefix);
		// The path is handed to the model as `fullOutputPath`, so it has to outlive this call;
		// registering it means the session cleans up after itself instead of filling tmpdir.
		registerTempFile(this.tempFilePath);
		this.tempFileStream = createWriteStream(this.tempFilePath);
		for (const chunk of this.rawChunks) {
			this.writeToTempFile(chunk);
		}
		this.rawChunks = [];
	}
}
