/**
 * Shared markdown fence scanner for the render pipeline (A.3). One rule set
 * for every consumer (shell injection, `@path` absolutization): an opening
 * fence is 3+ backticks or tildes indented at most 3 spaces; a closing fence
 * is a run of the same character, at least as long, with nothing but
 * whitespace after it (CommonMark closing rule for backtick fences). A
 * trailing CR is ignored when matching, so CRLF bodies parse the same as LF.
 */

export interface FenceBlock {
	/** Index of the opening fence line. */
	openLine: number;
	/** Index of the closing fence line, or -1 when the block is unterminated. */
	closeLine: number;
	/** Trimmed info string after the opening fence run. */
	info: string;
}

const FENCE_OPEN = /^(\s{0,3})(`{3,}|~{3,})([^\r\n]*)\r?$/;

/**
 * Scan `lines` (split without terminators) for fenced blocks in document
 * order. Blocks never overlap: a closing line is consumed, and anything
 * between an opener and its closer belongs to the block.
 */
export function scanFenceBlocks(lines: string[]): FenceBlock[] {
	const blocks: FenceBlock[] = [];
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
		blocks.push({ openLine: i, closeLine, info: open[3].trim() });
		i = closeLine === -1 ? lines.length : closeLine + 1;
	}
	return blocks;
}

/**
 * Ranges of inline code spans in `text` (CommonMark rule: a run of n
 * backticks opens a span closed by a run of exactly n backticks; an unclosed
 * run is literal text). Used to suppress shell-injection recognition inside
 * code spans, e.g. a documented `` ``!`cmd` `` `` example must not execute.
 */
export function inlineCodeSpans(text: string): Array<{ start: number; end: number }> {
	const runs = [...text.matchAll(/`+/g)];
	const spans: Array<{ start: number; end: number }> = [];
	let k = 0;
	while (k < runs.length) {
		const length = runs[k][0].length;
		let closer = -1;
		for (let j = k + 1; j < runs.length; j++) {
			if (runs[j][0].length === length) {
				closer = j;
				break;
			}
		}
		if (closer === -1) {
			k++;
			continue;
		}
		spans.push({ start: runs[k].index, end: runs[closer].index + length });
		k = closer + 1;
	}
	return spans;
}
