/**
 * Central tool-output policy: one cap for every tool result, builtin or not.
 *
 * pi's builtin tools truncate their own output (tools/truncate.ts), and the
 * well-behaved extensions reimplement the same contract by hand - same 50KB /
 * 2000-line values, similar notice text. Nothing enforces any of it: an
 * extension that skips the ritual returns however much it likes straight into
 * the model's context, and because it emits no marker, the flood is invisible
 * to marker-based measurement. Benchmarking found both failure shapes in one
 * afternoon: a tool whose byte ceiling sat exactly at the cap (silently
 * self-truncating with unrecognised phrasing) and tools whose only bound was
 * a 4MB process-safety buffer ~80x above what a context can absorb.
 *
 * This module is applied at the agent-session layer, after extension
 * tool_result hooks have run, so it sees exactly what would enter context and
 * whatever an extension hook substituted. Results already within the cap pass
 * through untouched - a POLICY_SLACK allowance means a tool that truncated
 * itself to the cap and appended its own notice is not truncated a second
 * time.
 *
 * The notice is CANONICAL on purpose. Measurement broke twice on marker
 * phrasing drift between tools; every policy truncation announces itself with
 * the same prefix, so one string finds them all.
 */
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "./tools/truncate.ts";

export interface ToolOutputPolicyOptions {
	maxBytes?: number;
	maxLines?: number;
}

/**
 * Headroom above the cap before the policy fires. A builtin or a well-behaved
 * extension returns cap-sized content PLUS its own truncation notice; clipping
 * that again would stack notices and shave real content for nothing.
 */
export const POLICY_SLACK_BYTES = 4 * 1024;
export const POLICY_SLACK_LINES = 16;

/** Canonical marker prefix; keep stable, measurement greps for it. */
export const POLICY_NOTICE_PREFIX = "[Output truncated: ";

export interface ToolOutputPolicyResult<TBlock> {
	content: TBlock[];
	/** True when the policy actually rewrote the content. */
	truncated: boolean;
	/** Bytes of text across all text blocks BEFORE the policy ran. */
	totalBytes: number;
}

type TextishBlock = { type?: string; text?: unknown };

const textOf = (block: TextishBlock): string | null =>
	block != null && block.type === "text" && typeof block.text === "string" ? block.text : null;

const countLines = (text: string): number => {
	if (text.length === 0) return 0;
	let n = 1;
	for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
	if (text.endsWith("\n")) n--;
	return n;
};

/**
 * Cap the text carried by a tool-result content array.
 *
 * Non-text blocks (images, arbitrary payloads) pass through untouched and do
 * not consume budget; only text enters model context by the ton. Text blocks
 * are kept in order, head-first, until the byte/line budget is exhausted;
 * everything after is dropped and a single canonical notice block is appended.
 */
export function applyToolOutputPolicy<TBlock extends TextishBlock>(
	content: readonly TBlock[] | undefined | null,
	options: ToolOutputPolicyOptions = {},
): ToolOutputPolicyResult<TBlock> {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const blocks = Array.isArray(content) ? content : [];

	let totalBytes = 0;
	let totalLines = 0;
	for (const b of blocks) {
		const t = textOf(b);
		if (t === null) continue;
		totalBytes += Buffer.byteLength(t, "utf-8");
		totalLines += countLines(t);
	}

	if (totalBytes <= maxBytes + POLICY_SLACK_BYTES && totalLines <= maxLines + POLICY_SLACK_LINES) {
		return { content: blocks as TBlock[], truncated: false, totalBytes };
	}

	const kept: TBlock[] = [];
	let bytesLeft = maxBytes;
	let linesLeft = maxLines;
	let keptBytes = 0;
	let keptLines = 0;

	// Head-first with a hard stop: once any text block has been clipped, every
	// later text block is dropped even if a few bytes of budget survive the
	// line-boundary rounding. Keeping a stray tail after a clipped head reads as
	// continuous output when it is not.
	let clipped = false;
	for (const b of blocks) {
		const t = textOf(b);
		if (t === null) {
			kept.push(b);
			continue;
		}
		if (clipped || bytesLeft <= 0 || linesLeft <= 0) continue;
		const r = truncateHead(t, { maxBytes: bytesLeft, maxLines: linesLeft });
		if (r.truncated) clipped = true;
		if (r.content.length > 0) {
			kept.push({ ...(b as object), text: r.content } as TBlock);
			bytesLeft -= r.outputBytes;
			linesLeft -= r.outputLines;
			keptBytes += r.outputBytes;
			keptLines += r.outputLines;
		}
	}

	const notice =
		`${POLICY_NOTICE_PREFIX}showing ${keptLines} of ${totalLines} lines ` +
		`(${formatSize(keptBytes)} of ${formatSize(totalBytes)}). ` +
		`Narrow the query, or page with offset/limit if the tool supports it.]`;
	kept.push({ type: "text", text: notice } as unknown as TBlock);

	return { content: kept, truncated: true, totalBytes };
}
