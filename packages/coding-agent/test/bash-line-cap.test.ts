import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Container } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forgetTempFile } from "../src/core/temp-file-registry.ts";
import { createBashTool, createBashToolDefinition } from "../src/core/tools/bash.ts";
import { OutputAccumulator, type OutputSnapshot } from "../src/core/tools/output-accumulator.ts";
import { capLineLengths, DEFAULT_MAX_LINE_CHARS } from "../src/core/tools/truncate.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const TRUNCATED_SUFFIX = "... [truncated]";
const TRUNCATED_PREFIX = "[truncated] ...";

function toBashSingleQuotedArg(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function getTextOutput(result: { content?: Array<{ type: string; text?: string }> }): string {
	return (
		result.content
			?.filter((block) => block.type === "text")
			.map((block) => block.text ?? "")
			.join("\n") ?? ""
	);
}

describe("capLineLengths", () => {
	it("leaves short lines byte-identical, CRLF and trailing newline included", () => {
		const input = "first\r\nsecond line\nthird\n";
		const result = capLineLengths(input, 20);

		expect(result.content).toBe(input);
		expect(result.cappedCount).toBe(0);
		expect(result.cappedLines).toEqual([false, false, false]);
	});

	it("caps a long line with the shared truncation marker without changing the line count", () => {
		const input = `head\n${"x".repeat(500)}\ntail`;
		const result = capLineLengths(input, 100);

		const lines = result.content.split("\n");
		expect(lines).toHaveLength(3);
		expect(lines[0]).toBe("head");
		expect(lines[1].startsWith("x".repeat(100))).toBe(true);
		expect(lines[1].endsWith(TRUNCATED_SUFFIX)).toBe(true);
		expect(lines[2]).toBe("tail");
		expect(result.cappedCount).toBe(1);
		expect(result.cappedLines).toEqual([false, true, false]);
	});

	it("caps the final line from its end so the output's last chars survive", () => {
		const input = `head\n${"a".repeat(500)}END`;
		const result = capLineLengths(input, 100);

		const lines = result.content.split("\n");
		expect(lines).toHaveLength(2);
		expect(lines[1].startsWith(TRUNCATED_PREFIX)).toBe(true);
		expect(lines[1].endsWith(`${"a".repeat(97)}END`)).toBe(true);
		expect(result.cappedLines).toEqual([false, true]);
	});

	it("does not split BMP characters at the cut", () => {
		const cjk = "漢".repeat(200);
		const result = capLineLengths(`before\n${cjk}\nafter`, 100);

		expect(result.content).not.toContain("\uFFFD");
		expect(result.cappedCount).toBe(1);
	});

	it("does not split surrogate pairs at either cut", () => {
		// An odd leading char forces the cut to land mid-pair for both directions.
		const astral = `a${"\u{1F600}".repeat(200)}`;
		const result = capLineLengths(`${astral}\n${astral}`, 101);

		// A lone surrogate silently becomes U+FFFD on UTF-8 encoding.
		expect(Buffer.from(result.content, "utf-8").toString("utf-8")).not.toContain("\uFFFD");
		expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(result.content)).toBe(false);
		expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(result.content)).toBe(false);
		expect(result.cappedCount).toBe(2);
	});

	it("returns everything unchanged when disabled", () => {
		const input = `${"x".repeat(5000)}\nshort\n`;
		const result = capLineLengths(input, 0);

		expect(result.content).toBe(input);
		expect(result.cappedCount).toBe(0);
		expect(result.cappedLines).toEqual([false, false]);
	});

	it("handles empty content and a single unterminated line", () => {
		expect(capLineLengths("", 100).content).toBe("");
		expect(capLineLengths("", 100).cappedLines).toEqual([]);

		const single = capLineLengths(`${"y".repeat(300)}`, 100);
		expect(single.content.split("\n")).toHaveLength(1);
		expect(single.cappedCount).toBe(1);
	});
});

describe("OutputAccumulator line cap", () => {
	const trackedPaths = new Set<string>();

	afterEach(() => {
		for (const path of trackedPaths) {
			rmSync(path, { force: true });
			forgetTempFile(path);
		}
		trackedPaths.clear();
	});

	function track(snapshot: OutputSnapshot): void {
		if (snapshot.fullOutputPath) trackedPaths.add(snapshot.fullOutputPath);
	}

	it("caps long lines in the snapshot while the temp file keeps the raw bytes", async () => {
		const accumulator = new OutputAccumulator({
			maxBytes: 8 * 1024,
			maxLines: 50,
			maxLineChars: 100,
			tempFilePrefix: "pi-line-cap-test",
		});
		const long = "y".repeat(500);
		accumulator.append(Buffer.from(`short one\n${long}\nshort two\n${long}\n`));
		accumulator.finish();
		const snapshot = accumulator.snapshot({ persistIfTruncated: true });
		track(snapshot);
		await accumulator.closeTempFile();

		// Raw output is under every limit, so only the line cap fired.
		expect(snapshot.truncation.truncated).toBe(false);
		expect(snapshot.maxLineChars).toBe(100);
		expect(snapshot.cappedLineCount).toBe(2);
		const lines = snapshot.content.split("\n");
		expect(lines).toHaveLength(5);
		expect(lines[1].endsWith(TRUNCATED_SUFFIX)).toBe(true);
		// The final line is capped from its end instead, so its tail survives.
		expect(lines[3].startsWith(TRUNCATED_PREFIX)).toBe(true);
		expect(lines[3].endsWith("y".repeat(100))).toBe(true);
		// Recovery is lossless: the spilled file holds the uncapped lines.
		expect(snapshot.fullOutputCapped).toBe(false);
		expect(readFileSync(snapshot.fullOutputPath ?? "", "utf-8")).toContain(long);
	});

	it("spends the byte budget on more lines once long lines are capped", async () => {
		const accumulator = new OutputAccumulator({
			maxBytes: 600,
			maxLines: 50,
			maxLineChars: 100,
			tempFilePrefix: "pi-line-cap-test",
		});
		for (let index = 0; index < 3; index++) accumulator.append(Buffer.from(`${"x".repeat(400)}\n`));
		accumulator.finish();
		const snapshot = accumulator.snapshot({ persistIfTruncated: true });
		track(snapshot);
		await accumulator.closeTempFile();

		// Uncapped, 400-char lines would blow the 600-byte budget after one line;
		// capped, all three fit.
		const lines = snapshot.content.split("\n");
		expect(lines).toHaveLength(4);
		expect(snapshot.cappedLineCount).toBe(3);
		expect(snapshot.truncation.truncated).toBe(true);
		expect(snapshot.truncation.outputLines).toBe(3);
		expect(snapshot.truncation.totalLines).toBe(3);
	});

	it("counts only capped lines that survive tail truncation", async () => {
		const accumulator = new OutputAccumulator({
			maxBytes: 64 * 1024,
			maxLines: 2,
			maxLineChars: 100,
			tempFilePrefix: "pi-line-cap-test",
		});
		accumulator.append(Buffer.from(`${"a".repeat(300)}\nshort\nshort\n${"b".repeat(300)}\nlast\n`));
		accumulator.finish();
		const snapshot = accumulator.snapshot({ persistIfTruncated: true });
		track(snapshot);
		await accumulator.closeTempFile();

		// Only the last two lines are shown; the long "a" line was dropped whole.
		expect(snapshot.truncation.outputLines).toBe(2);
		expect(snapshot.content.startsWith("b".repeat(100))).toBe(true);
		expect(snapshot.cappedLineCount).toBe(1);
	});

	it("keeps the end of a single giant line, not an interior slice", async () => {
		const accumulator = new OutputAccumulator({
			maxBytes: 50 * 1024,
			maxLines: 2000,
			maxLineChars: 1000,
			tempFilePrefix: "pi-line-cap-test",
		});
		// One 2MB line, no newline: `curl` of a JSON API, `cat` of a minified bundle.
		// The rolling tail buffer drops the head, so a head-capped line would hand back
		// a slice from ~100KB before the end - neither the start nor the result.
		accumulator.append(Buffer.from(`START${"a".repeat(2_000_000)}END`));
		accumulator.finish();
		const snapshot = accumulator.snapshot({ persistIfTruncated: true });
		track(snapshot);
		await accumulator.closeTempFile();

		expect(snapshot.cappedLineCount).toBe(1);
		expect(snapshot.content.startsWith(TRUNCATED_PREFIX)).toBe(true);
		expect(snapshot.content.endsWith("END")).toBe(true);
		expect(readFileSync(snapshot.fullOutputPath ?? "", "utf-8").endsWith("END")).toBe(true);
	});

	it("does not cap when disabled", () => {
		const accumulator = new OutputAccumulator({
			maxBytes: 8 * 1024,
			maxLines: 50,
			maxLineChars: 0,
			tempFilePrefix: "pi-line-cap-test",
		});
		accumulator.append(Buffer.from(`${"z".repeat(2000)}\n`));
		accumulator.finish();
		const snapshot = accumulator.snapshot({ persistIfTruncated: true });

		expect(snapshot.maxLineChars).toBe(0);
		expect(snapshot.cappedLineCount).toBe(0);
		expect(snapshot.content).toBe(`${"z".repeat(2000)}\n`);
		expect(snapshot.fullOutputPath).toBeUndefined();
	});
});

describe("bash tool line cap", () => {
	let testDir: string;

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "pi-bash-line-cap-test-"));
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("reports capped lines and points at the raw full-output file", async () => {
		const bashTool = createBashTool(testDir);
		const long = "z".repeat(1500);
		const command = `printf '%s\n%s\n' ${toBashSingleQuotedArg(long)} short`;
		const result = await bashTool.execute("test-linecap-footer", { command });
		const text = getTextOutput(result);
		const details = (result as { details?: { fullOutputPath?: string } }).details;

		expect(text).toContain(`1 line capped at ${DEFAULT_MAX_LINE_CHARS} chars.`);
		expect(text).toContain("Full output:");
		expect(text.endsWith("]")).toBe(true);
		expect(text).not.toContain(long);
		expect(details?.fullOutputPath).toBeDefined();
		expect(readFileSync(details?.fullOutputPath ?? "", "utf-8")).toContain(long);
		if (details?.fullOutputPath) {
			rmSync(details.fullOutputPath, { force: true });
			forgetTempFile(details.fullOutputPath);
		}
	});

	it("says all lines are shown when only the raw byte total tripped the limit", async () => {
		const bashTool = createBashTool(testDir);
		const command = "node -e \"for(let i=0;i<40;i++)console.log('z'.repeat(1400))\"";
		const result = await bashTool.execute("test-linecap-rawover", { command });
		const text = getTextOutput(result);
		const details = (result as { details?: { fullOutputPath?: string } }).details;

		expect(text).toContain("Showing all 40 lines");
		expect(text).toContain(`40 lines capped at ${DEFAULT_MAX_LINE_CHARS} chars.`);
		expect(text).toContain("Full output:");
		if (details?.fullOutputPath) {
			rmSync(details.fullOutputPath, { force: true });
			forgetTempFile(details.fullOutputPath);
		}
	});

	it("keeps the tail of a command whose output is one giant line", async () => {
		const bashTool = createBashTool(testDir);
		const command = "node -e \"process.stdout.write('S'+'a'.repeat(2000000)+'THE_END')\"";
		const result = await bashTool.execute("test-linecap-giant", { command });
		const text = getTextOutput(result);
		const details = (result as { details?: { fullOutputPath?: string } }).details;

		// The point of tail truncation: whatever the command ended with must survive.
		expect(text).toContain("THE_END");
		expect(text).toContain(`1 line capped at ${DEFAULT_MAX_LINE_CHARS} chars.`);
		if (details?.fullOutputPath) {
			rmSync(details.fullOutputPath, { force: true });
			forgetTempFile(details.fullOutputPath);
		}
	});

	it("renders the full-output path once when only the line cap fired", async () => {
		// Same definition on both sides: the wrapper runs it, the definition renders it.
		const definition = createBashToolDefinition(testDir);
		const long = "z".repeat(1500);
		const command = `printf '%s\n%s\n' ${toBashSingleQuotedArg(long)} short`;
		const result = await createBashTool(testDir).execute("test-linecap-render", { command });
		const details = (result as { details?: { fullOutputPath?: string } }).details;
		const fullOutputPath = details?.fullOutputPath ?? "";

		const component = definition.renderResult?.(result as never, { expanded: true, isPartial: false }, theme, {
			args: { command },
			toolCallId: "test-linecap-render",
			invalidate: () => {},
			lastComponent: undefined,
			state: {},
			cwd: testDir,
			executionStarted: true,
			showImages: false,
			isError: false,
		} as never);
		const container = new Container();
		if (component) container.addChild(component);
		const rendered = stripAnsi(container.render(200).join("\n"));

		expect(fullOutputPath).not.toBe("");
		expect(rendered.split(fullOutputPath).length - 1).toBe(1);
		expect(rendered).toContain(`1 line capped at ${DEFAULT_MAX_LINE_CHARS} chars`);
		rmSync(fullOutputPath, { force: true });
		forgetTempFile(fullOutputPath);
	});
});
