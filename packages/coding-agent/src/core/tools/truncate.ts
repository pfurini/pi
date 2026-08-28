/**
 * Shared truncation utilities for tool outputs.
 *
 * Truncation is based on two independent limits - whichever is hit first wins:
 * - Line limit (default: 2000 lines)
 * - Byte limit (default: 50KB)
 *
 * Never returns partial lines, except for the bash tail truncation edge case and
 * lines shortened by `capLineLengths`, which mark themselves with a [truncated] marker.
 */

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB
export const GREP_MAX_LINE_LENGTH = 500; // Max chars per grep match line
/** Floor for the per-line char allowance in shell output; 0 disables shortening. */
export const DEFAULT_MIN_LINE_CHARS = 1000;

export interface TruncationResult {
	/** The truncated content */
	content: string;
	/** Whether truncation occurred */
	truncated: boolean;
	/** Which limit was hit: "lines", "bytes", or null if not truncated */
	truncatedBy: "lines" | "bytes" | null;
	/** Total number of lines in the original content */
	totalLines: number;
	/** Total number of bytes in the original content */
	totalBytes: number;
	/** Number of complete lines in the truncated output */
	outputLines: number;
	/** Number of bytes in the truncated output */
	outputBytes: number;
	/** Whether the last line was partially truncated (only for tail truncation edge case) */
	lastLinePartial: boolean;
	/** Whether the first line exceeded the byte limit (for head truncation) */
	firstLineExceedsLimit: boolean;
	/** The max lines limit that was applied */
	maxLines: number;
	/** The max bytes limit that was applied */
	maxBytes: number;
}

export interface TruncationOptions {
	/** Maximum number of lines (default: 2000) */
	maxLines?: number;
	/** Maximum number of bytes (default: 50KB) */
	maxBytes?: number;
}

function splitLinesForCounting(content: string): string[] {
	if (content.length === 0) {
		return [];
	}
	const lines = content.split("\n");
	if (content.endsWith("\n")) {
		lines.pop();
	}
	return lines;
}

/**
 * Format bytes as human-readable size.
 */
export function formatSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes}B`;
	} else if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)}KB`;
	} else {
		return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
	}
}

/**
 * Truncate content from the head (keep first N lines/bytes).
 * Suitable for file reads where you want to see the beginning.
 *
 * Never returns partial lines. If first line exceeds byte limit,
 * returns empty content with firstLineExceedsLimit=true.
 */
export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

	const totalBytes = Buffer.byteLength(content, "utf-8");
	const lines = splitLinesForCounting(content);
	const totalLines = lines.length;

	// Check if no truncation needed
	if (totalLines <= maxLines && totalBytes <= maxBytes) {
		return {
			content,
			truncated: false,
			truncatedBy: null,
			totalLines,
			totalBytes,
			outputLines: totalLines,
			outputBytes: totalBytes,
			lastLinePartial: false,
			firstLineExceedsLimit: false,
			maxLines,
			maxBytes,
		};
	}

	// Check if first line alone exceeds byte limit
	const firstLineBytes = Buffer.byteLength(lines[0], "utf-8");
	if (firstLineBytes > maxBytes) {
		return {
			content: "",
			truncated: true,
			truncatedBy: "bytes",
			totalLines,
			totalBytes,
			outputLines: 0,
			outputBytes: 0,
			lastLinePartial: false,
			firstLineExceedsLimit: true,
			maxLines,
			maxBytes,
		};
	}

	// Collect complete lines that fit
	const outputLinesArr: string[] = [];
	let outputBytesCount = 0;
	let truncatedBy: "lines" | "bytes" = "lines";

	for (let i = 0; i < lines.length && i < maxLines; i++) {
		const line = lines[i];
		const lineBytes = Buffer.byteLength(line, "utf-8") + (i > 0 ? 1 : 0); // +1 for newline

		if (outputBytesCount + lineBytes > maxBytes) {
			truncatedBy = "bytes";
			break;
		}

		outputLinesArr.push(line);
		outputBytesCount += lineBytes;
	}

	// If we exited due to line limit
	if (outputLinesArr.length >= maxLines && outputBytesCount <= maxBytes) {
		truncatedBy = "lines";
	}

	const outputContent = outputLinesArr.join("\n");
	const finalOutputBytes = Buffer.byteLength(outputContent, "utf-8");

	return {
		content: outputContent,
		truncated: true,
		truncatedBy,
		totalLines,
		totalBytes,
		outputLines: outputLinesArr.length,
		outputBytes: finalOutputBytes,
		lastLinePartial: false,
		firstLineExceedsLimit: false,
		maxLines,
		maxBytes,
	};
}

/**
 * Truncate content from the tail (keep last N lines/bytes).
 * Suitable for bash output where you want to see the end (errors, final results).
 *
 * May return partial first line if the last line of original content exceeds byte limit.
 */
export function truncateTail(content: string, options: TruncationOptions = {}): TruncationResult {
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

	const totalBytes = Buffer.byteLength(content, "utf-8");
	const lines = splitLinesForCounting(content);
	const totalLines = lines.length;

	// Check if no truncation needed
	if (totalLines <= maxLines && totalBytes <= maxBytes) {
		return {
			content,
			truncated: false,
			truncatedBy: null,
			totalLines,
			totalBytes,
			outputLines: totalLines,
			outputBytes: totalBytes,
			lastLinePartial: false,
			firstLineExceedsLimit: false,
			maxLines,
			maxBytes,
		};
	}

	// Work backwards from the end
	const outputLinesArr: string[] = [];
	let outputBytesCount = 0;
	let truncatedBy: "lines" | "bytes" = "lines";
	let lastLinePartial = false;

	for (let i = lines.length - 1; i >= 0 && outputLinesArr.length < maxLines; i--) {
		const line = lines[i];
		const lineBytes = Buffer.byteLength(line, "utf-8") + (outputLinesArr.length > 0 ? 1 : 0); // +1 for newline

		if (outputBytesCount + lineBytes > maxBytes) {
			truncatedBy = "bytes";
			// Edge case: if we haven't added ANY lines yet and this line exceeds maxBytes,
			// take the end of the line (partial)
			if (outputLinesArr.length === 0) {
				const truncatedLine = truncateStringToBytesFromEnd(line, maxBytes);
				outputLinesArr.unshift(truncatedLine);
				outputBytesCount = Buffer.byteLength(truncatedLine, "utf-8");
				lastLinePartial = true;
			}
			break;
		}

		outputLinesArr.unshift(line);
		outputBytesCount += lineBytes;
	}

	// If we exited due to line limit
	if (outputLinesArr.length >= maxLines && outputBytesCount <= maxBytes) {
		truncatedBy = "lines";
	}

	const outputContent = outputLinesArr.join("\n");
	const finalOutputBytes = Buffer.byteLength(outputContent, "utf-8");

	return {
		content: outputContent,
		truncated: true,
		truncatedBy,
		totalLines,
		totalBytes,
		outputLines: outputLinesArr.length,
		outputBytes: finalOutputBytes,
		lastLinePartial,
		firstLineExceedsLimit: false,
		maxLines,
		maxBytes,
	};
}

/**
 * Truncate a string to fit within a byte limit (from the end).
 * Handles multi-byte UTF-8 characters correctly.
 */
function truncateStringToBytesFromEnd(str: string, maxBytes: number): string {
	const buf = Buffer.from(str, "utf-8");
	if (buf.length <= maxBytes) {
		return str;
	}

	// Start from the end, skip maxBytes back
	let start = buf.length - maxBytes;

	// Find a valid UTF-8 boundary (start of a character)
	while (start < buf.length && (buf[start] & 0xc0) === 0x80) {
		start++;
	}

	return buf.slice(start).toString("utf-8");
}

/**
 * Move a head-slice end index off the middle of a surrogate pair, so a cut never
 * leaves a lone surrogate that would encode as U+FFFD.
 */
function safeHeadCut(line: string, index: number): number {
	const code = line.charCodeAt(index - 1);
	return code >= 0xd800 && code <= 0xdbff ? index - 1 : index;
}

/** Mirror of `safeHeadCut` for a tail-slice start index. */
function safeTailCut(line: string, index: number): number {
	const code = line.charCodeAt(index);
	return code >= 0xdc00 && code <= 0xdfff ? index + 1 : index;
}

/**
 * Truncate a single line to max characters, adding [truncated] suffix.
 * Used for grep match lines.
 */
export function truncateLine(
	line: string,
	maxChars: number = GREP_MAX_LINE_LENGTH,
): { text: string; wasTruncated: boolean } {
	if (line.length <= maxChars) {
		return { text: line, wasTruncated: false };
	}
	return { text: `${line.slice(0, safeHeadCut(line, maxChars))}... [truncated]`, wasTruncated: true };
}

/** Upper bound on `excerptLine`'s middle marker: 26 fixed chars plus room for the digit count. */
const EXCERPT_MARKER_MAX_CHARS = 40;

/**
 * Keep both ends of an over-long line, marking the omitted middle.
 *
 * One-ended excerpts always lose something a caller needed: a single-line JSON
 * response needs its opening keys and its final values, and a single-line stack
 * trace needs the exception and the terminal cause.
 */
function excerptLine(line: string, maxChars: number): { text: string; wasTruncated: boolean } {
	if (line.length <= maxChars) {
		return { text: line, wasTruncated: false };
	}
	const head = line.slice(0, safeHeadCut(line, Math.ceil(maxChars / 2)));
	const tailChars = maxChars - head.length;
	const tail = tailChars > 0 ? line.slice(safeTailCut(line, line.length - tailChars)) : "";
	return {
		text: `${head}... [truncated ${line.length - head.length - tail.length} chars] ...${tail}`,
		wasTruncated: true,
	};
}

/**
 * Keep the end of a line whose head was already discarded upstream.
 *
 * Such a line is a fragment, so its `length` is not the real line's length: a count of
 * omitted chars derived from it would understate the loss, and pairing a "head" taken
 * from an arbitrary interior offset with the true tail would imply we still have the
 * start. Claim neither. Always marks, since the head is missing whether or not the
 * fragment itself needed shortening.
 */
function excerptLineEnd(line: string, maxChars: number): { text: string; wasTruncated: boolean } {
	const tail = line.length <= maxChars ? line : line.slice(safeTailCut(line, line.length - maxChars));
	return { text: `[truncated] ...${tail}`, wasTruncated: true };
}

export interface LineCapResult {
	/** Content with every over-length line excerpted in place. */
	content: string;
	/** Per-line flags aligned with the lines of `content` (trailing newline excluded). */
	cappedLines: boolean[];
	/** Number of lines shortened. */
	cappedCount: number;
	/** Per-line allowance actually applied. */
	allowance: number;
}

export interface LineCapOptions {
	/** Floor for the per-line allowance. `<= 0` disables capping. */
	minChars: number;
	/** Budget the lines share; each may use `maxBytes / lineCount` before the floor applies. */
	maxBytes: number;
	/**
	 * The first line's head was discarded before this call, so its length is not the
	 * real line's length. Its excerpt keeps the end and omits any char count.
	 */
	firstLineTruncated?: boolean;
}

/**
 * Shorten over-long lines so a byte budget is spent on distinct lines instead of one
 * giant one. Never adds or removes lines, and never moves content across the newline
 * separator: line counts and "Showing lines X-Y of Z" math stay exact.
 *
 * Each line may use its fair share of the budget, never less than `minChars`: one
 * giant line keeps the whole budget, forty long lines keep a fortieth each. A fixed
 * cap would hand back 1KB of a 2MB single-line response and leave the rest of the
 * budget unspent.
 *
 * A shortened line reports how many chars it dropped, which is only knowable for a
 * complete line. Set `firstLineTruncated` when the caller has already discarded that
 * line's head, and it keeps the end without claiming a count.
 *
 * The allowance counts characters, not bytes, so a shortened CJK or emoji line can
 * still be 3-4x its allowance in bytes. This bounds the damage one line can do; it is
 * not a byte bound, and tail truncation remains the hard enforcer.
 */
export function capLineLengths(content: string, options: LineCapOptions): LineCapResult {
	if (content.length === 0) return { content: "", cappedLines: [], cappedCount: 0, allowance: 0 };

	const endsWithNewline = content.endsWith("\n");
	const lines = content.split("\n");
	if (endsWithNewline) lines.pop();

	// Reserve the marker and the newline out of each line's share, so an excerpted line
	// still fits it. Otherwise a single line handed the whole budget overshoots by the
	// marker's width and tail truncation re-cuts it, eating the head we just preserved.
	const share = Math.floor(options.maxBytes / lines.length) - EXCERPT_MARKER_MAX_CHARS - 1;
	const allowance = Math.max(options.minChars, share);
	const cappedLines: boolean[] = new Array<boolean>(lines.length).fill(false);
	let cappedCount = 0;
	if (options.minChars > 0) {
		for (let index = 0; index < lines.length; index++) {
			const excerpt =
				index === 0 && options.firstLineTruncated
					? excerptLineEnd(lines[index], allowance)
					: excerptLine(lines[index], allowance);
			if (!excerpt.wasTruncated) continue;
			lines[index] = excerpt.text;
			cappedLines[index] = true;
			cappedCount++;
		}
	}
	if (cappedCount === 0) return { content, cappedLines, cappedCount, allowance };

	return { content: `${lines.join("\n")}${endsWithNewline ? "\n" : ""}`, cappedLines, cappedCount, allowance };
}
